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
 *
 * FIX-954 (Phase 1) redesigns the look-through UX with no leaf/contract
 * change: the holdings table and `TopPositions` both close their truncated
 * footer to 100% instead of silently dropping rows past the top 10, the
 * look-through sector block now draws `sectorResidual` (a field the leaf
 * already computed), opaque funds are regrouped into two collapsible
 * "not attributable" / "awaiting data" buckets via the shared
 * `classifyOpaqueReason` classifier, and `Effective positions` is gone from
 * BOTH stat rows — the wrapper-basis point estimate and the look-through
 * interval rendered the same label two blocks apart over different bases,
 * and the interval in particular was read literally as "how much of each
 * name do I own", which inverse-HHI does not answer. The leaf still computes
 * it and the analysis prompt still consumes it; only the two tiles are cut.
 *
 * The load-bearing derivation logic (row-model footers, the sector-block
 * render gate, the opaque-fund grouping) is extracted into pure, exported
 * helpers — this package has no JSX-rendering test harness, so they're
 * unit-tested directly from `test/health-section.spec.ts` (the
 * `buildHoldingRowModel` precedent, `holdings-table.tsx`). That split means
 * the arithmetic is covered and the JSX is not: three of the defects a
 * review caught after the first pass were on the JSX side of it (a
 * mislabelled residual bar, a badge counting entries instead of funds, a
 * footer that vanished when "show all" was clicked). Change the rendering
 * here and look at the actual screen — the helpers cannot catch it.
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
import {
  classifyOpaqueReason,
  type EffectiveNamePosition,
  type LookThroughExposure,
  type LookThroughResidual,
  type LookThroughSectorBucket,
  type OpaqueFund,
} from "@/domain/portfolio/math/etf-look-through";
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

/** The `Where` column's compact source list (FIX-954 §3 step 4): names every
 *  source instead of a bare count so a single-fund slice reads "VTI" and a
 *  wide one reads "Direct + N" — never just a number with no meaning. Up to
 *  two fund sources are named in full alongside a direct holding; beyond
 *  that it collapses to a count so the column stays scannable. */
export function formatSourcesLabel(sources: EffectiveNamePosition["sources"]): string {
  const hasDirect = sources.some((s) => s.from === "direct");
  const funds = sources.filter((s) => s.from !== "direct").map((s) => s.from);
  if (!hasDirect) return funds.join(", ");
  if (funds.length === 0) return "Direct";
  if (funds.length <= 2) return `Direct + ${funds.join(", ")}`;
  return `Direct + ${funds.length}`;
}

/** The look-through holdings table's row model (FIX-954 §3 step 1): the
 *  shown top-N positions, a rolled-up tail for the rest, and the axis's own
 *  residual — so the rendered footer closes to the SAME total the leaf
 *  already computed, instead of the table silently truncating at `showCount`
 *  and leaving the column short (§0.1 — the reported "percentages don't add
 *  up" defect). Never renormalizes: `tail` and `residual` are additive rows,
 *  not a redistribution of the shown rows' weight. */
export type LookThroughHoldingsRowModel = {
  shown: EffectiveNamePosition[];
  tail: { count: number; weightPct: number; marketValue: number };
  residual: { weightPct: number; marketValue: number };
  total: { weightPct: number; marketValue: number };
};

export function buildLookThroughHoldingsRowModel(
  positions: EffectiveNamePosition[],
  residual: LookThroughResidual,
  showCount = 10,
): LookThroughHoldingsRowModel {
  const shown = positions.slice(0, showCount);
  const rest = positions.slice(showCount);
  const tailWeightPct = rest.reduce((s, p) => s + p.weightPct, 0);
  const tailMarketValue = rest.reduce((s, p) => s + p.marketValue, 0);
  const shownWeightPct = shown.reduce((s, p) => s + p.weightPct, 0);
  const shownMarketValue = shown.reduce((s, p) => s + p.marketValue, 0);
  return {
    shown,
    tail: { count: rest.length, weightPct: tailWeightPct, marketValue: tailMarketValue },
    residual: { weightPct: residual.sharePct, marketValue: residual.marketValue },
    total: {
      weightPct: shownWeightPct + tailWeightPct + residual.sharePct,
      marketValue: shownMarketValue + tailMarketValue + residual.marketValue,
    },
  };
}

/** `TopPositions`'s row model (FIX-954 §3 step 2) — the identical
 *  `.slice(0, 10)` truncation defect as the look-through table, on the
 *  WRAPPER basis: the priced, exposure-weighted positions are already
 *  exhaustive — no separate residual bucket — so closing the footer is just
 *  recovering the tail the truncation used to drop silently. Both an
 *  unpriced row AND a cash row are excluded before the split: cash has a
 *  non-null `marketValue` but a null `exposureWeightPct` (it isn't part of
 *  the invested book — `portfolio-health.ts:334`), so filtering on
 *  `marketValue` alone let a cash row read as a "smaller position" and mixed
 *  an invested-NAV-denominated weight total with a total-NAV market-value
 *  total (FIX-954 review). `all` is the full filtered, unsliced list — the
 *  same set `shown` is drawn from — so `TopPositions`'s "show all" doesn't
 *  need its own second filter over the raw positions (FIX-954 review,
 *  BP-010). */
export type TopPositionsRowModel = {
  all: HealthPosition[];
  shown: HealthPosition[];
  tail: { count: number; weightPct: number; marketValue: number };
  total: { weightPct: number; marketValue: number };
};

export function buildTopPositionsRowModel(
  positions: HealthPosition[],
  showCount = 10,
): TopPositionsRowModel {
  const priced = positions.filter((p) => p.marketValue !== null && p.exposureWeightPct !== null);
  const shown = priced.slice(0, showCount);
  const rest = priced.slice(showCount);
  const sum = (rows: HealthPosition[]) => ({
    weightPct: rows.reduce((s, p) => s + (p.exposureWeightPct ?? 0), 0),
    marketValue: rows.reduce((s, p) => s + (p.marketValue ?? 0), 0),
  });
  const tail = sum(rest);
  const shownTotals = sum(shown);
  return {
    all: priced,
    shown,
    tail: { count: rest.length, ...tail },
    total: {
      weightPct: shownTotals.weightPct + tail.weightPct,
      marketValue: shownTotals.marketValue + tail.marketValue,
    },
  };
}

/** Whether the look-through sector block has anything to draw (FIX-954 §7
 *  step 3). The coverage gate is PER AXIS, so a book where every fund passes
 *  the name axis and fails sectors renders an empty `sectorExposure` with
 *  100% of the mass sitting in `sectorResidual` — the old guard
 *  (`sectorExposure.length > 0`) hid the block in exactly that case, the one
 *  the residual matters most in. */
export function shouldRenderLookThroughSectors(
  exposure: Pick<LookThroughExposure, "sectorExposure" | "sectorResidual">,
): boolean {
  return exposure.sectorExposure.length > 0 || exposure.sectorResidual.marketValue > 0;
}

/** Groups opaque funds into the two buckets the FIX-954 pane renders (§0.5,
 *  §2.1), via `classifyOpaqueReason` — the single classifier the pane and
 *  the analysis prompt share, so they can never disagree about which funds
 *  are still awaited. `classifyOpaqueReason` returns THREE values (`policy`
 *  / `data` / `awaiting`) because a later coverage ceiling needs to subtract
 *  `policy` alone (§2.1); the UI renders only two groups —
 *  `"not attributable"` (policy + data) and `"awaiting data"` (awaiting). */
export function groupOpaqueFunds(
  funds: OpaqueFund[],
): { notAttributable: OpaqueFund[]; awaitingData: OpaqueFund[] } {
  const notAttributable: OpaqueFund[] = [];
  const awaitingData: OpaqueFund[] = [];
  for (const f of funds) {
    if (classifyOpaqueReason(f.reason, f.axis) === "awaiting") awaitingData.push(f);
    else notAttributable.push(f);
  }
  return { notAttributable, awaitingData };
}

/** Unique-ticker count within an `OpaqueFund[]` group — the badge the pane
 *  renders next to each `OpaqueFundGroup`. `groupOpaqueFunds`'s arrays are
 *  intentionally NOT deduped by ticker (a fund thin on both the name and
 *  sector axes emits two entries with two distinct reason strings —
 *  `etf-look-through.ts:1019-1025` — and collapsing them would silently drop
 *  one from the expanded per-fund list). But a bare `funds.length` then
 *  double-counts that fund, disagreeing with the analysis prompt's own
 *  `opaqueFundCount` (`build-portfolio-context.ts`'s `classifyOpaqueFunds`),
 *  which dedupes by ticker for exactly this reason. This is the one place
 *  that needs to match: it sizes the SAME count the prompt reports, on the
 *  SAME funds. */
export function uniqueFundCount(funds: OpaqueFund[]): number {
  return new Set(funds.map((f) => f.ticker)).size;
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
  // docblock). Judged by the DOMINANT (largest-market-value) lot, hence
  // `priceMap` passed through — the same rule `summarizePortfolioHealth`
  // itself uses below (Codex review, FIX-801 sub-PR c round 14).
  const etfProfiles = useMemo(
    () =>
      excludeFixedIncomeFromProfileMap(
        toFundProfileMap(etfProfilesResponseToRows(etfProfileEntries, etfRefusalEntries)),
        accounts.flatMap((a) => a.holdings),
        priceMap,
      ),
    [etfProfileEntries, etfRefusalEntries, accounts, priceMap],
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
      {/* FIX-954 §2 — the lower-bound sentence sits ABOVE every number it
       *  qualifies; the scope note (this read doesn't move sizing) stays at
       *  the bottom, near the funds it's about. Splitting the old single
       *  trailing paragraph by function is the whole fix. */}
      <p className="px-1 pb-2 text-[10px] text-[color:var(--c-fg-faint)]">
        Effective exposure is a LOWER BOUND — uncovered fund weight is a residual, never
        renormalized, so a flag firing above is trustworthy but one not firing is not a clean bill
        of health.
      </p>
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
        {/* `Effective positions` is deliberately ABSENT from both stat rows
         *  (FIX-954 §0.3 / §6). The wrapper-basis point estimate and this
         *  look-through interval rendered the SAME label two blocks apart over
         *  different bases, and the interval in particular (a `1.5–338.1`-style
         *  range) is what a reader took literally as "how much of each name do I
         *  own" — a question inverse-HHI does not answer. The holdings table
         *  below answers it directly, so both readings are cut from the UI. The
         *  leaf still computes `effectivePositions` and the analysis prompt still
         *  consumes it, where a model can use the interval's width. */}
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
      <LookThroughPositions positions={exposure.positions} residual={exposure.residual} />
      {shouldRenderLookThroughSectors(exposure) && (
        <div className="pt-2">
          {/* Names both halves: the block renders whenever there are attributed
           *  sectors OR residual mass, and the residual-only case (every fund
           *  thin on the sector axis but attributed on the name axis) is exactly
           *  what step 3's relaxed guard exists to show. A caption reading only
           *  "Attributed sectors" would then sit above a block with none
           *  (Codex review, PR #959). */}
          <div className="px-1 pb-1 text-[10px] text-[color:var(--c-fg-faint)]">
            Sectors seen inside funds, plus what couldn&apos;t be attributed — closes to 100% of
            invested NAV. Real sectors on this axis, no &quot;Funds&quot; bucket.
          </div>
          <LookThroughSectors buckets={exposure.sectorExposure} residual={exposure.sectorResidual} />
        </div>
      )}
      {exposure.opaqueFunds.length > 0 && <OpaqueFunds funds={exposure.opaqueFunds} />}
      <p className="px-1 pt-2 text-[10px] text-[color:var(--c-fg-faint)]">
        This read does not change position sizing in analysis runs.
      </p>
    </div>
  );
}

/** Effective names on the look-through basis (FIX-954 §3 step 1) — every
 *  row is expandable to show which wrapper each slice came from (including
 *  the direct holding itself as one of the sources), and the footer closes
 *  the column to 100% via `buildLookThroughHoldingsRowModel`: a rolled-up
 *  tail for names past the top 10, the axis's own residual, and a total row
 *  — so the table stops silently truncating (§0.1). `Where` names sources
 *  via `formatSourcesLabel` instead of a bare count. */
function LookThroughPositions({
  positions,
  residual,
}: {
  positions: EffectiveNamePosition[];
  residual: LookThroughResidual;
}): ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  const model = useMemo(
    () => buildLookThroughHoldingsRowModel(positions, residual),
    [positions, residual],
  );
  if (positions.length === 0 && residual.marketValue <= 0) {
    return <p className="px-1 text-[10.5px] text-[color:var(--c-fg-faint)]">No fund attributed a resolvable name.</p>;
  }
  return (
    <div className="overflow-hidden rounded-md border border-[color:var(--c-border)]">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[color:var(--c-fg-faint)]">
            <th className="px-2 py-1 text-left font-normal">Ticker</th>
            <th className="px-2 py-1 text-right font-normal">Effective weight</th>
            <th className="px-2 py-1 text-right font-normal">Value</th>
            <th className="px-2 py-1 text-right font-normal">Where</th>
          </tr>
        </thead>
        <tbody>
          {model.shown.map((p) => {
            const isOpen = expanded === p.ticker;
            return (
              <Fragment key={p.ticker}>
                <tr
                  className="cursor-pointer border-t border-[color:var(--c-border)] hover:bg-[color:var(--c-surface-2)]/50"
                  onClick={() => setExpanded(isOpen ? null : p.ticker)}
                >
                  <td className="px-2 py-1 font-mono text-[color:var(--c-fg)]">
                    {isOpen ? "▾ " : "▸ "}
                    {p.ticker}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-[color:var(--c-fg)]">{pct(p.weightPct)}</td>
                  <td className="px-2 py-1 text-right font-mono text-[color:var(--c-fg-muted)]">
                    {formatMoney(p.marketValue, "USD")}
                  </td>
                  <td className="px-2 py-1 text-right font-mono text-[color:var(--c-fg-muted)]">
                    {formatSourcesLabel(p.sources)}
                  </td>
                </tr>
                {isOpen &&
                  p.sources.map((s, i) => (
                    <tr key={`${p.ticker}-${s.from}-${i}`} className="bg-[color:var(--c-surface)]/40 text-[color:var(--c-fg-muted)]">
                      <td className="px-2 py-0.5 pl-6 text-[10.5px]">{s.from === "direct" ? "Direct" : s.from}</td>
                      <td className="px-2 py-0.5" />
                      <td className="px-2 py-0.5 text-right font-mono text-[10.5px]">{formatMoney(s.marketValue, "USD")}</td>
                      <td className="px-2 py-0.5" />
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot className="text-[color:var(--c-fg-faint)]">
          {model.tail.count > 0 && (
            <tr className="border-t border-[color:var(--c-border)]">
              <td className="px-2 py-1">+ {model.tail.count} smaller names</td>
              <td className="px-2 py-1 text-right font-mono">{pct(model.tail.weightPct)}</td>
              <td className="px-2 py-1 text-right font-mono">{formatMoney(model.tail.marketValue, "USD")}</td>
              <td className="px-2 py-1" />
            </tr>
          )}
          {model.residual.marketValue > 0 && (
            <tr className="border-t border-[color:var(--c-border)]">
              <td className="px-2 py-1">Not attributed to a name</td>
              <td className="px-2 py-1 text-right font-mono">{pct(model.residual.weightPct)}</td>
              <td className="px-2 py-1 text-right font-mono">{formatMoney(model.residual.marketValue, "USD")}</td>
              <td className="px-2 py-1" />
            </tr>
          )}
          <tr className="border-t border-[color:var(--c-border)] font-semibold text-[color:var(--c-fg)]">
            <td className="px-2 py-1">Total</td>
            <td className="px-2 py-1 text-right font-mono">{pct(model.total.weightPct)}</td>
            <td className="px-2 py-1 text-right font-mono">{formatMoney(model.total.marketValue, "USD")}</td>
            <td className="px-2 py-1" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Look-through sector bars (FIX-954 §7 step 3 adds the trailing `residual`
 *  bar — the leaf already computes `sectorResidual`, but the UI never drew
 *  it, so the column silently stopped short of 100%). Otherwise plain — no
 *  per-bucket expansion; unlike the wrapper basis's `SectorExposure`, a
 *  look-through bucket carries no constituent list to drill into. */
function LookThroughSectors({
  buckets,
  residual,
}: {
  buckets: LookThroughSectorBucket[];
  residual: LookThroughResidual;
}): ReactElement {
  return (
    <div className="space-y-1.5">
      {buckets.map((s) => (
        <Bar key={s.bucket} label={s.bucket} pctValue={s.pct} valueText={pct(s.pct)} />
      ))}
      {residual.marketValue > 0 && (
        <Bar
          pctValue={residual.sharePct}
          label="Not attributed to a sector"
          valueText={pct(residual.sharePct)}
          tone="muted"
        />
      )}
    </div>
  );
}

/** Funds left unattributed on one or both axes (FIX-954 §7 step 4) —
 *  regrouped via `groupOpaqueFunds` (step 0's shared `classifyOpaqueReason`)
 *  into the two groups the pane and the analysis prompt agree on: funds that
 *  will never resolve (policy exclusions, or data too thin to trust) versus
 *  funds that may still resolve on a future fetch/refresh. Each group is its
 *  own single-open disclosure (the file's existing idiom) instead of one
 *  run-on paragraph. No dollar/percent figures here — those need
 *  `OpaqueFund.marketValue`, a Phase 2 leaf addition (FIX-954 spec §7). */
function OpaqueFunds({ funds }: { funds: OpaqueFund[] }): ReactElement {
  const [open, setOpen] = useState<"notAttributable" | "awaitingData" | null>(null);
  const { notAttributable, awaitingData } = useMemo(() => groupOpaqueFunds(funds), [funds]);
  return (
    <div className="space-y-1.5 pt-1">
      <OpaqueFundGroup
        label="Not attributable"
        funds={notAttributable}
        caption="Either excluded by policy (never decomposed by design) or the fund's data is too thin to trust."
        isOpen={open === "notAttributable"}
        onToggle={() => setOpen(open === "notAttributable" ? null : "notAttributable")}
      />
      <OpaqueFundGroup
        label="Awaiting data"
        funds={awaitingData}
        caption="May resolve on a future fetch or profile refresh — no fixed timeline."
        isOpen={open === "awaitingData"}
        onToggle={() => setOpen(open === "awaitingData" ? null : "awaitingData")}
      />
    </div>
  );
}

/** One collapsible opaque-fund group (`OpaqueFunds`'s two rows). Renders
 *  nothing when empty, so a book with only one kind of gap doesn't show an
 *  empty disclosure. */
function OpaqueFundGroup({
  label,
  funds,
  caption,
  isOpen,
  onToggle,
}: {
  label: string;
  funds: OpaqueFund[];
  caption: string;
  isOpen: boolean;
  onToggle: () => void;
}): ReactElement | null {
  if (funds.length === 0) return null;
  return (
    <div className="text-[10px]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 text-left text-[color:var(--c-fg-muted)]"
      >
        <span className="w-2 shrink-0 text-[color:var(--c-fg-faint)]">{isOpen ? "▾" : "▸"}</span>
        <span>{label}</span>
        <span className="text-[color:var(--c-fg-faint)]">({uniqueFundCount(funds)})</span>
      </button>
      {isOpen && (
        <div className="ml-4 mt-1 space-y-1 border-l border-[color:var(--c-border)] pb-1 pl-3 text-[color:var(--c-fg-faint)]">
          <p>{caption}</p>
          <p>
            {funds.map((f, i) => (
              <span key={`${f.ticker}-${f.axis}`}>
                {i > 0 ? "; " : ""}
                {f.ticker} ({f.axis}) — {f.reason}
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

/** The ticker-merged top-positions table: exposure weight + account count, with a
 *  per-account split on expand (the drill-down the household merge enables).
 *  FIX-954 §3 step 2 — the identical `.slice(0, 10)` truncation defect
 *  `LookThroughPositions` had (§0.1): `buildTopPositionsRowModel` rolls the
 *  rest into a tail row + total footer, and "Show all" lifts the cap
 *  entirely, preserving the statement-basis read (every priced position
 *  accounted for, not just the top 10). The Total row renders
 *  UNCONDITIONALLY (FIX-954 review — it used to be gated inside the same
 *  `!showAll && tail.count > 0` check as the tail row, so a book with ≤10
 *  priced positions never got a total, and clicking "show all" made the
 *  total DISAPPEAR — the opposite of this change's headline claim); only the
 *  tail row itself stays gated on `!showAll`. "Show all" is two-way — the
 *  Total row's own label becomes the "show top 10 only" toggle back once
 *  expanded, so there's a way back from the full list. */
function TopPositions({ positions }: { positions: HealthPosition[] }): ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const model = useMemo(() => buildTopPositionsRowModel(positions), [positions]);
  const shown = showAll ? model.all : model.shown;
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
          {shown.map((p) => {
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
        <tfoot className="text-[color:var(--c-fg-faint)]">
          {!showAll && model.tail.count > 0 && (
            <tr className="border-t border-[color:var(--c-border)]">
              <td className="px-2 py-1" colSpan={2}>
                <button type="button" onClick={() => setShowAll(true)} className="hover:underline">
                  + {model.tail.count} smaller positions — show all
                </button>
              </td>
              <td className="px-2 py-1 text-right font-mono">{pct(model.tail.weightPct)}</td>
              <td className="px-2 py-1" />
            </tr>
          )}
          <tr className="border-t border-[color:var(--c-border)] font-semibold text-[color:var(--c-fg)]">
            <td className="px-2 py-1" colSpan={2}>
              {showAll && model.tail.count > 0 ? (
                <button type="button" onClick={() => setShowAll(false)} className="hover:underline">
                  Total — show top 10 only
                </button>
              ) : (
                "Total"
              )}
            </td>
            <td className="px-2 py-1 text-right font-mono">{pct(model.total.weightPct)}</td>
            <td className="px-2 py-1" />
          </tr>
        </tfoot>
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
