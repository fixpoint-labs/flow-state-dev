/**
 * HealthSection — the portfolio pane's household Health perspective (FIX-762):
 * the deterministic answer to "how balanced is my book?" across every account.
 * Ticker-merged exposure, asset-class + sector breakdowns, concentration reads
 * with honest caveats, cash level, and coverage — all from the pure
 * `summarizePortfolioHealth` leaf (no model calls; money math is arithmetic).
 *
 * Self-contained the way `GainsTaxesSection` is (FIX-885): props in, one `useMemo`
 * compute (BP-010), no IO except `useClassifications(heldEquityTickers)` — the
 * sole axis with no on-holding data, fetched only when this section is mounted so
 * opening Accounts / Gains never triggers a Yahoo fan-out.
 *
 * Drift-vs-target and standing-constraint compliance are the FIX-761-gated slice
 * (they read the durable mandate); the allocation view shows actual-only bars
 * until that lands. Charts are inline CSS bars — no chart library (the Summary
 * view precedent). Missing figures render `DASH`, never fabricated (BP-020).
 */
"use client";

import { useMemo, useState, type ReactElement } from "react";
import type { Quote } from "@/src/flows/portfolio/get-quotes";
import type { AccountState } from "@/src/flows/portfolio/portfolio-schema";
import {
  summarizePortfolioHealth,
  FUNDS_BUCKET,
  type HealthPosition,
  type QuoteMap,
} from "@/src/flows/portfolio/portfolio-health";
import { useClassifications } from "./use-classifications";
import { ASSET_CLASS_LABELS, DASH, formatMoney } from "./portfolio-format";
import { cn } from "@/lib/utils";

type HealthSectionProps = {
  /** Every account (inline holdings) from `usePortfolioAccounts`. */
  accounts: AccountState[];
  /** UPPER ticker → last-known quote (the pane's `priceMap`, FIX-823). */
  priceMap: Map<string, Quote>;
  /** Oldest quote as-of across all rows ("as of at least"); null when none. */
  pricesAsOf: string | null;
  /** Whether a session is bound (the pane-wide gate for a live picture). */
  hasSession: boolean;
  /** Trigger the pinned toolbar's live price refresh (the no-quotes empty state). */
  onRefreshPrices: () => void;
};

/** Percent as "12.4%" (leaf pcts are 0..100, unlike `formatPercent`'s 0..1). */
function pct(value: number | null): string {
  return value === null ? DASH : `${value.toFixed(1)}%`;
}

/** A labelled inline bar (0..100). Purely presentational. */
function Bar({ pctValue, label, valueText, tone = "accent" }: {
  pctValue: number | null;
  label: string;
  valueText: string;
  tone?: "accent" | "muted";
}): ReactElement {
  const width = pctValue === null ? 0 : Math.min(100, Math.max(0, Math.abs(pctValue)));
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <div className="w-28 shrink-0 truncate text-[color:var(--c-fg-muted)]" title={label}>
        {label}
      </div>
      <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-[color:var(--c-surface-2)]">
        <div
          className="absolute inset-y-0 left-0 rounded-sm"
          style={{
            width: `${width}%`,
            background: tone === "accent" ? "var(--c-accent)" : "var(--c-fg-faint)",
          }}
        />
      </div>
      <div className="w-14 shrink-0 text-right font-mono text-[color:var(--c-fg)]">{valueText}</div>
    </div>
  );
}

/** A stat cell: a big number over a small label. */
function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="font-mono text-[15px] text-[color:var(--c-fg)]">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">{label}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: string }): ReactElement {
  return (
    <div className="px-1 pb-1 font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
      {children}
    </div>
  );
}

export function HealthSection({
  accounts,
  priceMap,
  pricesAsOf,
  hasSession,
  onRefreshPrices,
}: HealthSectionProps): ReactElement {
  // The route derives the held equity tickers server-side (only single-name
  // equities use the sector axis); the hook passes only userId.
  const { classifications } = useClassifications();

  const health = useMemo(() => {
    const quotes: QuoteMap = new Map();
    for (const [ticker, q] of priceMap) quotes.set(ticker, { price: q.price, asOf: q.asOf });
    return summarizePortfolioHealth(accounts, quotes, classifications, pricesAsOf);
  }, [accounts, priceMap, classifications, pricesAsOf]);

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <p className="text-sm text-[color:var(--c-fg)]">No accounts yet</p>
        <p className="max-w-md text-xs text-[color:var(--c-fg-muted)]">
          Add an account and import your holdings to see the household health view.
        </p>
      </div>
    );
  }

  // NAV is known once anything is valued (priced positions OR cash) — an all-cash
  // book is fully valued and must show its 100%-cash allocation, not a stray
  // "refresh prices" prompt. Exposure / concentration / sector need actual
  // invested (non-cash) mass; a refresh helps only when a holding is unpriced.
  const navKnown = health.totalNav !== null;
  const hasInvested = (health.investedNav ?? 0) > 0;
  const hasUnpriced = health.coverage.unpricedTickers.length > 0;
  const hasFunds = health.sectorExposure.some((s) => s.bucket === FUNDS_BUCKET);

  return (
    <div className="space-y-5">
      {/* Headline: NAV + cash. A refresh affordance appears only when something is
          unvalued (unpriced holdings, or nothing valued at all). */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-6">
          <Stat label="Household NAV" value={health.totalNav === null ? DASH : formatMoney(health.totalNav, "USD")} />
          <Stat label="Invested" value={health.investedNav === null ? DASH : formatMoney(health.investedNav, "USD")} />
          <Stat
            label="Cash"
            value={`${formatMoney(health.cash.amount, "USD")}${health.cash.pct === null ? "" : ` · ${pct(health.cash.pct)}`}`}
          />
          <Stat label="Positions" value={`${health.coverage.pricedPositions} / ${health.coverage.totalPositions}`} />
        </div>
        {(!navKnown || hasUnpriced) && (
          <button
            type="button"
            onClick={onRefreshPrices}
            disabled={!hasSession}
            className={cn(
              "h-7 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px]",
              hasSession ? "hover:bg-[color:var(--c-surface-2)]" : "cursor-not-allowed opacity-50",
            )}
          >
            Refresh prices
          </button>
        )}
      </div>

      {!navKnown ? (
        <p className="text-[11px] text-[color:var(--c-fg-muted)]">
          {hasSession
            ? "Refresh prices to value your holdings and see exposure, concentration, and sector breakdowns."
            : "Run an analysis to bind a session, then refresh prices to value your holdings."}
        </p>
      ) : (
        <>
          {/* 1. Asset-class allocation (of total NAV) — actual-only bars until the
              FIX-761 mandate lands the drift-vs-target overlay. */}
          <div>
            <SectionTitle>Allocation — % of total NAV</SectionTitle>
            <div className="space-y-1.5">
              {health.assetClassAllocation.map((a) => (
                <Bar
                  key={a.assetClass}
                  label={ASSET_CLASS_LABELS[a.assetClass]}
                  pctValue={a.pct}
                  valueText={pct(a.pct)}
                />
              ))}
            </div>
            <p className="px-1 pt-1 text-[10px] text-[color:var(--c-fg-faint)]">
              Set a portfolio mandate to see drift vs target.
            </p>
          </div>

          {/* 2. Concentration — only when there is invested (non-cash) mass; an
              all-cash book has no exposure to concentrate. */}
          {hasInvested && (
          <div>
            <SectionTitle>Concentration — % of invested NAV</SectionTitle>
            <div className="flex flex-wrap gap-6 pb-2">
              <Stat
                label="Largest name"
                value={
                  health.concentration.maxPosition === null
                    ? DASH
                    : `${health.concentration.maxPosition.ticker} ${pct(health.concentration.maxPosition.weightPct)}`
                }
              />
              <Stat label="Top 5" value={pct(health.concentration.top5Pct)} />
              <Stat label="Top 10" value={pct(health.concentration.top10Pct)} />
              <Stat
                label="Effective positions"
                value={
                  health.concentration.effectivePositions === null
                    ? DASH
                    : health.concentration.effectivePositions.toFixed(1)
                }
              />
            </div>
            {health.concentration.flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-2">
                {health.concentration.flags.map((f, i) => (
                  <span
                    key={i}
                    className="rounded-full px-2 py-0.5 text-[10px]"
                    style={{
                      background: "var(--c-surface-2)",
                      color: f.level === "alert" ? "var(--c-warn)" : "var(--c-fg-muted)",
                    }}
                  >
                    {f.kind === "single_name"
                      ? `${f.ticker} ${pct(f.weightPct)} (${f.level})`
                      : `${f.sector} ${pct(f.weightPct)} (warn)`}
                  </span>
                ))}
              </div>
            )}
            <TopPositions positions={health.positions} />
            {hasFunds && (
              <p className="px-1 pt-1 text-[10px] text-[color:var(--c-fg-faint)]">
                Funds (ETFs / mutual funds) are exempt from single-name flags — no look-through in this view.
              </p>
            )}
          </div>
          )}

          {/* 3. Sector exposure (of invested NAV) — invested mass only. */}
          {hasInvested && (
          <div>
            <SectionTitle>Sector exposure — % of invested NAV</SectionTitle>
            <div className="space-y-1.5">
              {health.sectorExposure.map((s) => (
                <Bar
                  key={s.bucket}
                  label={s.bucket}
                  pctValue={s.pct}
                  valueText={pct(s.pct)}
                  tone={s.bucket === FUNDS_BUCKET ? "muted" : "accent"}
                />
              ))}
            </div>
          </div>
          )}

          {/* 4. Coverage & provenance. */}
          <div className="border-t border-[color:var(--c-border)] pt-2 text-[10px] text-[color:var(--c-fg-faint)]">
            Priced {health.coverage.pricedPositions} of {health.coverage.totalPositions} positions
            {health.coverage.unpricedTickers.length > 0
              ? ` · unpriced: ${health.coverage.unpricedTickers.join(", ")}`
              : ""}
            {health.coverage.excludedTickers.length > 0
              ? ` · ⚠ inconsistent: ${health.coverage.excludedTickers.join(", ")}`
              : ""}
            {pricesAsOf ? ` · prices as of ${pricesAsOf}` : ""}
          </div>
        </>
      )}
    </div>
  );
}

/** The ticker-merged top-positions table: exposure weight + account count, with a
 *  per-account split on expand (the drill-down the household merge enables). */
function TopPositions({ positions }: { positions: HealthPosition[] }): ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  // Priced positions only (unpriced ride at the bottom with no weight to rank on).
  const priced = positions.filter((p) => p.marketValue !== null).slice(0, 10);
  return (
    <div className="overflow-hidden rounded-md border border-[color:var(--c-border)]">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[color:var(--c-fg-faint)]">
            <th className="px-2 py-1 text-left font-normal">Ticker</th>
            <th className="px-2 py-1 text-left font-normal">Class</th>
            <th className="px-2 py-1 text-right font-normal">Exposure</th>
            <th className="px-2 py-1 text-right font-normal">Accounts</th>
          </tr>
        </thead>
        <tbody>
          {priced.map((p) => {
            const isOpen = expanded === p.ticker;
            const multi = p.accounts.length > 1;
            return (
              <FragmentRow
                key={p.ticker}
                position={p}
                isOpen={isOpen}
                multi={multi}
                onToggle={() => setExpanded(isOpen ? null : p.ticker)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({ position: p, isOpen, multi, onToggle }: {
  position: HealthPosition;
  isOpen: boolean;
  multi: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <>
      <tr
        className={cn("border-t border-[color:var(--c-border)]", multi && "cursor-pointer hover:bg-[color:var(--c-surface-2)]/50")}
        onClick={multi ? onToggle : undefined}
      >
        <td className="px-2 py-1 font-mono text-[color:var(--c-fg)]">
          {multi ? (isOpen ? "▾ " : "▸ ") : ""}
          {p.ticker}
          {p.excludedRows > 0 ? " ⚠" : ""}
        </td>
        <td className="px-2 py-1 text-[color:var(--c-fg-muted)]">{ASSET_CLASS_LABELS[p.assetClass]}</td>
        <td className="px-2 py-1 text-right font-mono text-[color:var(--c-fg)]">{pct(p.exposureWeightPct)}</td>
        <td className="px-2 py-1 text-right font-mono text-[color:var(--c-fg-muted)]">{p.accounts.length}</td>
      </tr>
      {isOpen &&
        p.accounts.map((a, i) => (
          <tr key={`${p.ticker}-${a.accountId}-${i}`} className="bg-[color:var(--c-surface)]/40 text-[color:var(--c-fg-muted)]">
            <td className="px-2 py-0.5 pl-6 text-[10.5px]">{a.label}</td>
            <td className="px-2 py-0.5" />
            <td className="px-2 py-0.5 text-right font-mono text-[10.5px]">{a.marketValue === null ? DASH : formatMoney(a.marketValue, "USD")}</td>
            <td className="px-2 py-0.5 text-right font-mono text-[10.5px]">{a.quantity}</td>
          </tr>
        ))}
    </>
  );
}
