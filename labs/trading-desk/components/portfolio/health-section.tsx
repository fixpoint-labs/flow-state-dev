/**
 * HealthSection — the portfolio pane's household Health perspective (FIX-762):
 * the deterministic answer to "how balanced is my book?" across every account.
 * Ticker-merged exposure, asset-class + sector breakdowns, concentration reads
 * with honest caveats, cash level, and coverage — all from the pure
 * `summarizePortfolioHealth` leaf (no model calls; money math is arithmetic).
 * FIX-801 adds a second, additive read beside it — the ETF look-through axis,
 * seeing INSIDE funds — computed by the SAME leaf's optional trailing argument.
 *
 * Self-contained the way `GainsTaxesSection` is (FIX-885): props in, one `useMemo`
 * compute (BP-010), plus two lazy-fill hooks mounted only here so opening
 * Accounts / Gains never triggers their fan-out: `useClassifications()` — the
 * sole wrapper-basis axis with no on-holding data — and `useEtfProfiles()`
 * (FIX-801) for the look-through axis's stored fund profiles.
 *
 * Drift-vs-target and standing-constraint compliance are the FIX-761-gated slice
 * (they read the durable mandate); the allocation view shows actual-only bars
 * until that lands. Charts are inline CSS bars — no chart library (the Summary
 * view precedent). Missing figures render `DASH`, never fabricated (BP-020).
 */
"use client";

import { Fragment, useEffect, useMemo, useState, type ReactElement } from "react";
import type { Quote } from "@/domain/portfolio/services/get-quotes";
import type { AccountState } from "@/domain/portfolio/schema/portfolio-schema";
import {
  summarizePortfolioHealth,
  FUNDS_BUCKET,
  type HealthPosition,
  type PortfolioHealth,
  type QuoteMap,
} from "@/domain/portfolio/math/portfolio-health";
import type { EffectiveNamePosition, LookThroughSectorBucket, OpaqueFund } from "@/domain/portfolio/math/etf-look-through";
import { excludeFixedIncomeFromProfileMap, toFundProfileMap } from "@/domain/portfolio/math/etf-profile-map";
import { useClassifications } from "./use-classifications";
import { etfProfilesResponseToRows, useEtfProfiles } from "./use-etf-profiles";
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
  /**
   * Refetch accounts after the classifications route self-heals a mistyped
   * fund/crypto holding — without this, the prop-fed book stays stale and the
   * corrected ticker keeps rendering as an unclassified equity until reload.
   */
  onAccountsCorrected: () => void;
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
  onAccountsCorrected,
}: HealthSectionProps): ReactElement {
  // The route derives the held equity tickers server-side (only single-name
  // equities use the sector axis); the hook passes only userId.
  const { classifications, reclassifiedTickers } = useClassifications();

  // ETF/mutual-fund holdings profiles (FIX-801) for the look-through axis —
  // the route derives the eligible fund set server-side; this hook passes
  // `accounts`/`priceMap` only to build its own eligibility-refetch signature
  // (see `useEtfProfiles`'s docblock), never a client-computed ticker list.
  const { profiles: etfProfileEntries, refusals: etfRefusalEntries } = useEtfProfiles(
    accounts,
    priceMap,
  );

  // Genuine external sync: the classifications GET may have just corrected a
  // mistyped holding server-side; pull a fresh accounts snapshot so Health
  // renders the post-heal book (BP-010 — an effect is correct for a refetch).
  useEffect(() => {
    if (reclassifiedTickers.length === 0) return;
    onAccountsCorrected();
  }, [reclassifiedTickers, onAccountsCorrected]);

  // Ticker-keyed `FundProfileInput` map the pure leaf expects — one shared
  // conversion (`toFundProfileMap`, over `etfProfilesResponseToRows`'s row
  // projection) from the route's client projection, exactly mirroring the
  // analysis seed's own use of the same adapter over the repository's row
  // shape (FIX-801 sub-PR c).
  // A stored profile surviving the broad cache read is not itself permission
  // to attribute through it — a bond ETF, or a holding since manually
  // reclassified to fixed_income, must stay opaque regardless of a
  // (possibly stale, possibly another household's) cached profile (Codex
  // review, FIX-801 sub-PR c; see `excludeFixedIncomeFromProfileMap`'s
  // docblock).
  const etfProfiles = useMemo(
    () =>
      excludeFixedIncomeFromProfileMap(
        toFundProfileMap(etfProfilesResponseToRows(etfProfileEntries, etfRefusalEntries)),
        accounts.flatMap((a) => a.holdings),
      ),
    [etfProfileEntries, etfRefusalEntries, accounts],
  );

  const health = useMemo(() => {
    const quotes: QuoteMap = new Map();
    for (const [ticker, q] of priceMap) quotes.set(ticker, { price: q.price, asOf: q.asOf });
    return summarizePortfolioHealth(accounts, quotes, classifications, pricesAsOf, etfProfiles);
  }, [accounts, priceMap, classifications, pricesAsOf, etfProfiles]);

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
                {health.lookThrough === "partial"
                  ? "Funds are exempt from single-name flags on this wrapper-basis view — see the look-through read below for effective exposure inside funds. Look-through does not change analysis sizing decisions."
                  : "Funds (ETFs / mutual funds) are exempt from single-name flags on this wrapper-basis view. A look-through read appears below once a fund's holdings profile is available."}
              </p>
            )}
          </div>
          )}

          {/* 2b. Look-through (FIX-801) — a SECOND, additive read that sees
              INSIDE funds: a direct holding and the same name held through a
              fund add up instead of sitting apart. Never restyles or replaces
              the wrapper-basis blocks above (Decision 2) — this is its own
              section, rendered only once something was actually attributed
              through a fund. */}
          {hasInvested && health.lookThrough === "partial" && health.lookThroughExposure && (
          <LookThroughSection exposure={health.lookThroughExposure} />
          )}

          {/* 3. Sector exposure (of invested NAV) — invested mass only; each
              bucket expands to its constituent tickers. */}
          {hasInvested && (
          <div>
            <SectionTitle>Sector exposure — % of invested NAV</SectionTitle>
            <SectorExposure buckets={health.sectorExposure} />
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

/** Sector-exposure bars, each expandable to its constituent tickers (weight desc).
 *  Mirrors the `TopPositions` single-open disclosure idiom. This is the WRAPPER
 *  BASIS (Decision 2 — untouched, never restyled): expanding "Funds (no
 *  look-through)" is how a fund-heavy book sees WHICH funds drive that bucket on
 *  THIS axis; expanding "Unclassified" shows which equities have no resolved
 *  sector. The look-through axis's real, per-fund-attributed sector read (FIX-801)
 *  is a separate section (`LookThroughSection` / `LookThroughSectors`), rendered
 *  only when something was actually attributed through a fund. A bucket with no
 *  constituents (never, in practice — a bar exists only because a position landed
 *  in it) is inert. */
function SectorExposure({ buckets }: { buckets: PortfolioHealth["sectorExposure"] }): ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      {buckets.map((s) => {
        const isOpen = expanded === s.bucket;
        const canExpand = s.constituents.length > 0;
        const width = s.pct === null ? 0 : Math.min(100, Math.max(0, Math.abs(s.pct)));
        return (
          <div key={s.bucket}>
            <button
              type="button"
              onClick={canExpand ? () => setExpanded(isOpen ? null : s.bucket) : undefined}
              disabled={!canExpand}
              className={cn(
                "flex w-full items-center gap-2 text-left text-[11px]",
                canExpand && "cursor-pointer",
              )}
            >
              <div className="flex w-28 shrink-0 items-center gap-1 text-[color:var(--c-fg-muted)]" title={s.bucket}>
                <span className="w-2 shrink-0 text-[color:var(--c-fg-faint)]">
                  {canExpand ? (isOpen ? "▾" : "▸") : ""}
                </span>
                <span className="truncate">{s.bucket}</span>
              </div>
              <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-[color:var(--c-surface-2)]">
                <div
                  className="absolute inset-y-0 left-0 rounded-sm"
                  style={{
                    width: `${width}%`,
                    background: s.bucket === FUNDS_BUCKET ? "var(--c-fg-faint)" : "var(--c-accent)",
                  }}
                />
              </div>
              <div className="w-14 shrink-0 text-right font-mono text-[color:var(--c-fg)]">{pct(s.pct)}</div>
            </button>
            {isOpen && (
              <div className="mb-1 ml-4 mt-1 space-y-0.5 border-l border-[color:var(--c-border)] pb-1 pl-3">
                {s.constituents.map((c) => (
                  <div key={c.ticker} className="flex items-center gap-3 text-[10.5px]">
                    <span className="flex-1 truncate font-mono text-[color:var(--c-fg)]">{c.ticker}</span>
                    <span className="w-12 shrink-0 text-right font-mono text-[color:var(--c-fg-muted)]">
                      {pct(c.weightPct)}
                    </span>
                    <span className="w-20 shrink-0 text-right font-mono text-[color:var(--c-fg-muted)]">
                      {formatMoney(c.marketValue, "USD")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The ETF look-through section (FIX-801) — effective exposure SEEING INSIDE
 *  funds: coverage on both axes, the tagged look-through flags, the top
 *  effective names with their per-wrapper source breakdown, real attributed
 *  sectors (no "Funds" bucket on this axis), the named-incomplete funds, and
 *  the honesty copy every consumer of this axis must carry (Decision 3: a
 *  LOWER bound; Non-goals: this reading does not move the analysis pipeline's
 *  sizing decisions — mirrors the same line the prompt-block formatter
 *  renders, `flows/analysis/lib/format.ts`'s `appendLookThroughLines`). */
function LookThroughSection({ exposure }: { exposure: NonNullable<PortfolioHealth["lookThroughExposure"]> }): ReactElement {
  return (
    <div>
      <SectionTitle>Look-through — % of invested NAV (seeing inside funds)</SectionTitle>
      <div className="flex flex-wrap gap-6 pb-2">
        <Stat label="Name coverage" value={pct(exposure.coveragePct)} />
        <Stat label="Sector coverage" value={pct(exposure.sectorCoveragePct)} />
        <Stat
          label="Effective largest name"
          value={
            exposure.maxPosition === null
              ? DASH
              : `${exposure.maxPosition.ticker} ${pct(exposure.maxPosition.weightPct)}`
          }
        />
        {/* An INTERVAL, not a point estimate (Decision 4, docs/etf-look-through.md)
         *  — the unattributed residual could sit anywhere from a long tail
         *  (`high`) to piling entirely onto the largest name already seen
         *  (`low`). Was computed by the leaf but never surfaced here until now
         *  (Codex review, FIX-801 sub-PR c). */}
        <Stat
          label="Effective positions"
          value={
            exposure.effectivePositions === null
              ? DASH
              : `${exposure.effectivePositions.low.toFixed(1)}–${exposure.effectivePositions.high.toFixed(1)}`
          }
        />
      </div>
      {exposure.flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {exposure.flags.map((f, i) => (
            <span
              key={i}
              className="rounded-full px-2 py-0.5 text-[10px]"
              style={{
                background: "var(--c-surface-2)",
                color: f.level === "alert" ? "var(--c-warn)" : "var(--c-fg-muted)",
              }}
            >
              {f.kind === "single_name"
                ? `${f.ticker} ${pct(f.weightPct)} (${f.level}, look-through)`
                : `${f.sector} ${pct(f.weightPct)} (warn, look-through)`}
            </span>
          ))}
        </div>
      )}
      <LookThroughPositions positions={exposure.positions} />
      {exposure.sectorExposure.length > 0 && (
        <div className="pt-2">
          <div className="px-1 pb-1 text-[10px] text-[color:var(--c-fg-faint)]">
            Attributed sectors (real sectors, no "Funds" bucket on this axis)
          </div>
          <LookThroughSectors buckets={exposure.sectorExposure} />
        </div>
      )}
      {exposure.opaqueFunds.length > 0 && <OpaqueFunds funds={exposure.opaqueFunds} />}
      <p className="px-1 pt-2 text-[10px] text-[color:var(--c-fg-faint)]">
        Effective exposure is a LOWER BOUND — uncovered fund weight is a residual, never
        renormalized, so a flag firing above is trustworthy but one not firing is not a clean bill
        of health. This read does not change position sizing in analysis runs.
      </p>
    </div>
  );
}

/** Effective names on the look-through basis, expandable to show which
 *  wrapper each slice came from (including the direct holding itself as one
 *  of the sources) — the same two-level disclosure idiom `TopPositions` and
 *  `SectorExposure` already use. A SINGLE-source name (through exactly one
 *  fund, or direct-only) needs no expand affordance, but the Sources column
 *  still names that one source inline instead of a bare "1" — dropping the
 *  per-wrapper breakdown in the single-fund case understates the methodology
 *  (Codex review, FIX-801 sub-PR c). */
function LookThroughPositions({ positions }: { positions: EffectiveNamePosition[] }): ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  const top = positions.slice(0, 10);
  if (top.length === 0) {
    return <p className="px-1 text-[10.5px] text-[color:var(--c-fg-faint)]">No fund attributed a resolvable name.</p>;
  }
  return (
    <div className="overflow-hidden rounded-md border border-[color:var(--c-border)]">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[color:var(--c-fg-faint)]">
            <th className="px-2 py-1 text-left font-normal">Ticker</th>
            <th className="px-2 py-1 text-right font-normal">Effective weight</th>
            <th className="px-2 py-1 text-right font-normal">Sources</th>
          </tr>
        </thead>
        <tbody>
          {top.map((p) => {
            const isOpen = expanded === p.ticker;
            const multi = p.sources.length > 1;
            return (
              <Fragment key={p.ticker}>
                <tr
                  className={cn(
                    "border-t border-[color:var(--c-border)]",
                    multi && "cursor-pointer hover:bg-[color:var(--c-surface-2)]/50",
                  )}
                  onClick={multi ? () => setExpanded(isOpen ? null : p.ticker) : undefined}
                >
                  <td className="px-2 py-1 font-mono text-[color:var(--c-fg)]">
                    {multi ? (isOpen ? "▾ " : "▸ ") : ""}
                    {p.ticker}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-[color:var(--c-fg)]">{pct(p.weightPct)}</td>
                  <td className="px-2 py-1 text-right font-mono text-[color:var(--c-fg-muted)]">
                    {multi
                      ? p.sources.length
                      : // A single source needs no expand affordance, but
                        // still owes the same per-wrapper breakdown the
                        // multi-source expanded view gives — a bare "1"
                        // dropped which single fund (or the direct holding)
                        // this name came through (Codex review, FIX-801
                        // sub-PR c).
                        p.sources[0].from === "direct"
                        ? "Direct"
                        : p.sources[0].from}
                  </td>
                </tr>
                {isOpen &&
                  p.sources.map((s, i) => (
                    <tr key={`${p.ticker}-${s.from}-${i}`} className="bg-[color:var(--c-surface)]/40 text-[color:var(--c-fg-muted)]">
                      <td className="px-2 py-0.5 pl-6 text-[10.5px]">{s.from === "direct" ? "Direct" : s.from}</td>
                      <td className="px-2 py-0.5 text-right font-mono text-[10.5px]">{formatMoney(s.marketValue, "USD")}</td>
                      <td className="px-2 py-0.5" />
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Look-through sector bars — plain (no per-bucket expansion; unlike the
 *  wrapper basis's `SectorExposure`, a look-through bucket carries no
 *  constituent list to drill into). */
function LookThroughSectors({ buckets }: { buckets: LookThroughSectorBucket[] }): ReactElement {
  return (
    <div className="space-y-1.5">
      {buckets.map((s) => {
        const width = s.pct === null ? 0 : Math.min(100, Math.max(0, Math.abs(s.pct)));
        return (
          <div key={s.bucket} className="flex items-center gap-2 text-[11px]">
            <div className="w-28 shrink-0 truncate text-[color:var(--c-fg-muted)]" title={s.bucket}>
              {s.bucket}
            </div>
            <div className="relative h-3 flex-1 overflow-hidden rounded-sm bg-[color:var(--c-surface-2)]">
              <div
                className="absolute inset-y-0 left-0 rounded-sm"
                style={{ width: `${width}%`, background: "var(--c-accent)" }}
              />
            </div>
            <div className="w-14 shrink-0 text-right font-mono text-[color:var(--c-fg)]">{pct(s.pct)}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Funds left unattributed on one or both axes, with why — the "named as
 *  incomplete, not half-attributed" honesty gate (Decision 4). */
function OpaqueFunds({ funds }: { funds: OpaqueFund[] }): ReactElement {
  return (
    <div className="px-1 pt-1 text-[10px] text-[color:var(--c-fg-faint)]">
      <span className="text-[color:var(--c-fg-muted)]">Incomplete fund data: </span>
      {funds.map((f, i) => (
        <span key={`${f.ticker}-${f.axis}`}>
          {i > 0 ? "; " : ""}
          {f.ticker} ({f.axis}) — {f.reason}
        </span>
      ))}
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
