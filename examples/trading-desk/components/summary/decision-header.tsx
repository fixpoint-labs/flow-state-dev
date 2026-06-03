/**
 * DecisionHeader — the Summary's top block: the PM 5-tier rating bar (PmHero
 * idiom), the model-implied rating + band with clamp flag, decision confidence,
 * a one-line trade summary, and agree/differ-with-trader.
 *
 * Every figure traces to a stored PM/trader field via the aggregate. When the
 * PM memo has not published, it renders a "Decision pending" state rather than a
 * fabricated rating (real-money gate). The not-advice disclaimer is owned by the
 * persistent StatusBar, not duplicated here.
 */
import type { ReactElement } from "react";
import type {
  DecisionSummary,
  TradeLevels,
} from "./aggregate";
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

          {/* Model-implied rating + band + clamp flag */}
          {decision.modelImpliedRating !== null ||
          decision.ratingBand !== null ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[color:var(--c-fg-muted)]">
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

          {/* Trade one-liner */}
          {trade !== null ? <TradeLine trade={trade} /> : null}

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
    </section>
  );
}

function TradeLine({ trade }: { trade: NonNullable<TradeLevels> }): ReactElement {
  const parts: string[] = [];
  if (trade.direction !== null) parts.push(trade.direction.toUpperCase());
  // `sizePct` is "% of NAV as the trader proposed it" — labeled exactly that,
  // never a dollar amount (no account value in scope; spec 06 §9.1).
  if (trade.sizePct !== null) parts.push(`${trade.sizePct}% NAV`);
  if (trade.stopPrice !== null) parts.push(`stop ${trade.stopPrice}`);
  if (trade.targetPrice !== null) parts.push(`target ${trade.targetPrice}`);
  if (trade.holdingPeriod !== null) parts.push(trade.holdingPeriod);
  if (parts.length === 0) return <></>;
  return (
    <p className="font-mono text-[12px] text-[color:var(--c-fg)]">
      {parts.join(" · ")}
    </p>
  );
}
